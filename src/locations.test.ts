import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { apiPost } from './api'
import { postContentFlags } from './content'
import { executeDatabaseDomain } from './database-domain'
import { geocodeLocation, locationDestination, locationMapProvider, mapTilerRasterTileUrl,
  parseLocationQuery, flyingText, resolveAirports, locationCacheKey } from './locations'
import type { LocationView } from './types'
import { linkify } from './utils'

describe('#map', () => {
  test('parses the first non-empty line after the modifier', () => {
    expect(parseLocationQuery('Going hiking tomorrow #map\n\n Kallikratis, Crete \nSomewhere else'))
      .toBe('Kallikratis, Crete')
    expect(parseLocationQuery('Going hiking tomorrow #location\nKallikratis, Crete'))
      .toBe('Kallikratis, Crete')
    expect(parseLocationQuery('```text\n#location\nKallikratis\n```')).toBeNull()
  })

  test('stores only resolved location metadata with the post', async () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY);
      INSERT INTO posts VALUES(1);
      CREATE TABLE location_geocodes(query TEXT PRIMARY KEY,latitude REAL,longitude REAL,display_name TEXT);
      CREATE TABLE location_geocode_misses(query TEXT PRIMARY KEY);
      CREATE TABLE location_map_previews(cache_key TEXT PRIMARY KEY,image_key TEXT,width INTEGER,height INTEGER);
      CREATE TABLE post_locations(post_id INTEGER PRIMARY KEY,query TEXT,latitude REAL,longitude REAL,
        display_name TEXT);`)
    await executeDatabaseDomain(database, 'api.persistPostLocation', { postId: 1, query: 'Kallikratis, Crete',
      location: { query: 'Kallikratis, Crete', latitude: 35.2, longitude: 24.2,
        displayName: 'Kallikratis, Sfakia, Crete, Greece', imageKey: 'location-maps/test.png',
        imageUrl: '/uploads/location-maps/test.png', imageWidth: 600, imageHeight: 315 } })
    expect(database.query('SELECT * FROM post_locations').get()).toEqual({ post_id: 1, query: 'Kallikratis, Crete',
      latitude: 35.2, longitude: 24.2, display_name: 'Kallikratis, Sfakia, Crete, Greece' })
  })

  test('handles an empty geocoding result without throwing', async () => {
    const fetcher = (() =>
      Promise.resolve(new Response('[]', {
        headers: { 'content-type': 'application/json' },
      }))) as unknown as typeof fetch
    expect(await geocodeLocation('Nowhere', fetcher)).toBeNull()
  })

  test('requests English geocoding results', async () => {
    let requestUrl = ''
    let requestLanguage = ''
    const fetcher = ((input: URL | RequestInfo, init?: RequestInit) => {
      requestUrl = String(input)
      requestLanguage = new Headers(init?.headers).get('accept-language') || ''
      return Promise.resolve(new Response('[{"lat":"35.2","lon":"24.2","display_name":"Kallikratis, Crete, Greece"}]', {
        headers: { 'content-type': 'application/json' },
      }))
    }) as unknown as typeof fetch
    expect(await geocodeLocation('Kallikratis, Crete', fetcher)).toMatchObject({
      displayName: 'Kallikratis, Crete, Greece',
    })
    expect(new URL(requestUrl).searchParams.get('accept-language')).toBe('en')
    expect(requestLanguage).toBe('en')
  })

  test('uses MapTiler Topo raster tiles with the configured API key', () => {
    const url = mapTilerRasterTileUrl(4, 3, 'test key')
    expect(url.origin).toBe('https://api.maptiler.com')
    expect(url.pathname).toBe('/maps/topo-v2/256/3/4/3.png')
    expect(url.searchParams.get('key')).toBe('test key')
  })

  test('selects native map destinations from the requesting platform', () => {
    const location = { query: 'Kallikratis, Crete', latitude: 35.2, longitude: 24.2 }
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18 Safari/605.1.15'
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148'
    const android = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 Safari/537.36'
    expect(locationMapProvider(safari)).toBe('apple')
    expect(locationMapProvider(iphone)).toBe('apple')
    expect(locationDestination(location, safari)).toStartWith('https://maps.apple.com/?')
    expect(locationMapProvider(android)).toBe('google')
    expect(locationMapProvider(windows)).toBe('google')
    expect(locationDestination(location, windows)).toStartWith('https://www.google.com/maps/search/?')
    expect(locationMapProvider('unknown')).toBe('openstreetmap')
    expect(locationDestination(location, 'unknown')).toContain('openstreetmap.org')
  })

  test('gracefully skips miss caching on a database awaiting the repair migration', async () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY);
      INSERT INTO posts VALUES(1);
      CREATE TABLE location_geocodes(query TEXT PRIMARY KEY,latitude REAL,longitude REAL,display_name TEXT);
      CREATE TABLE location_map_previews(cache_key TEXT PRIMARY KEY,image_key TEXT,width INTEGER,height INTEGER);
      CREATE TABLE post_locations(post_id INTEGER PRIMARY KEY,query TEXT,latitude REAL,longitude REAL,
        display_name TEXT);`)
    expect(await executeDatabaseDomain(database, 'api.cachedLocation', { query: 'Nowhere' })).toBeNull()
    expect(await executeDatabaseDomain(database, 'api.persistPostLocation', {
      postId: 1,
      query: 'Nowhere',
      location: null,
    })).toBeNull()
  })

  test('renders the location with the existing OG-style preview', () => {
    const location: LocationView = { query: 'Kallikratis, Crete', latitude: 35.2, longitude: 24.2,
      displayName: 'Kallikratis, Sfakia, Crete, Greece',
      url: 'https://www.openstreetmap.org/?mlat=35.2&mlon=24.2#map=3/35.2/24.2', preview: {
        imageUrl: '/uploads/location-maps/test.png',
        title: 'Kallikratis',
        description: 'Sfakia, Crete, Greece',
        imageWidth: 600,
        imageHeight: 315,
      } }
    const html = linkify('Going hiking #map\nKallikratis, Crete', {}, [], undefined, undefined, '', { map: 1 }, {}, {
      signedIn: false,
      formPrefix: 'post-1',
      location,
    })
    expect(html).toContain('<a class="reference-menu-trigger" href="/tag/map">#map</a>')
    expect(html).toContain('noopener noreferrer">Kallikratis, Crete</a><a class="remote-link-popover"')
    expect(html).toContain('class="remote-link-popover"')
    expect(html).toContain('remote-link-image-sized')
    expect(html).toContain('Kallikratis')
    expect(html).toContain('Sfakia, Crete, Greece')
    expect(html).not.toContain('remote-link-site')
  })

  test('enriches the public API post shape with the stored location', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,handle TEXT,deleted_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,parent_id INTEGER,body TEXT,created_at TEXT,
        deleted_at TEXT,execution_output TEXT);
      CREATE TABLE post_hashtags(post_id INTEGER,tag TEXT);
      CREATE TABLE post_mentions(post_id INTEGER,user_id INTEGER);
      CREATE TABLE location_map_previews(cache_key TEXT PRIMARY KEY,image_key TEXT,width INTEGER,height INTEGER);
      CREATE TABLE post_locations(post_id INTEGER PRIMARY KEY,query TEXT,latitude REAL,longitude REAL,
        display_name TEXT);
      INSERT INTO users VALUES(1,'mapper',NULL);
      INSERT INTO posts VALUES(1,1,NULL,'Going hiking #map\nKallikratis, Crete','2026-08-29',NULL,NULL);
      INSERT INTO post_hashtags VALUES(1,'map');
      INSERT INTO post_locations VALUES(1,'Kallikratis, Crete',35.2,24.2,'Kallikratis, Sfakia, Crete, Greece');
      INSERT INTO location_map_previews VALUES('3:3:35.200000:24.200000','location-maps/test.png',600,315);`)
    const apiLocation = apiPost(database, 1, 'https://textlog.example')?.location
    expect(apiLocation).toMatchObject({
      query: 'Kallikratis, Crete',
      latitude: 35.2,
      longitude: 24.2,
      preview: { imageUrl: '/uploads/location-maps/test.png', title: 'Kallikratis' },
    })
    expect(apiLocation?.preview.siteName).toBeUndefined()
  })

  test('loads flight maps through the public API using the route cache key', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,handle TEXT,deleted_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,parent_id INTEGER,body TEXT,created_at TEXT,
        deleted_at TEXT,execution_output TEXT);
      CREATE TABLE post_hashtags(post_id INTEGER,tag TEXT);
      CREATE TABLE post_mentions(post_id INTEGER,user_id INTEGER);
      CREATE TABLE location_map_previews(cache_key TEXT PRIMARY KEY,image_key TEXT,width INTEGER,height INTEGER);
      CREATE TABLE post_locations(post_id INTEGER PRIMARY KEY,query TEXT,latitude REAL,longitude REAL,
        display_name TEXT);
      INSERT INTO users VALUES(1,'mapper',NULL);
      INSERT INTO posts VALUES(1,1,NULL,'#flying Heraklion → Berlin','2026-08-29',NULL,NULL);
      INSERT INTO post_hashtags VALUES(1,'flying');
      INSERT INTO post_locations VALUES(1,'Heraklion → Berlin',35.2,24.2,'Heraklion Airport → Berlin Brandenburg Airport');
      INSERT INTO location_map_previews VALUES('3:3:35.200000:24.200000:flight:Heraklion -> Berlin','location-maps/test.png',600,315);`)
    const apiLocation = apiPost(database, 1, 'https://textlog.example')?.location
    expect(apiLocation).toMatchObject({
      query: 'Heraklion → Berlin',
      latitude: 35.2,
      longitude: 24.2,
      preview: { imageUrl: '/uploads/location-maps/test.png', title: 'Heraklion Airport → Berlin Brandenburg Airport' },
    })
    expect(apiLocation?.preview.siteName).toBeUndefined()
  })
})


describe('#flying', () => {
  test('uses only the next three words and accepts each separator', async () => {
    for (const separator of ['to', 'TO', '->', '→']) {
      const body = `#flying Heraklion ${separator} Berlin and bla bla`
      const token = flyingText(body)!
      expect(token.query).toBe(`Heraklion ${separator} Berlin`)
      expect(body.slice(token.index, token.lastIndex)).toBe(token.query)
      expect(parseLocationQuery(body)).toBe('Heraklion -> Berlin')
      const html = linkify(body, {}, [], undefined, postContentFlags(body), '', { flying: 1 }, {}, {
        signedIn: false, formPrefix: 'flight', location: {
          query: 'Heraklion -> Berlin', latitude: 35.3, longitude: 25.2, displayName: 'HER → BER',
          url: 'https://www.openstreetmap.org/',
          preview: { imageUrl: '/uploads/flight.png', title: 'HER → BER', imageWidth: 600, imageHeight: 315 },
        },
      })
      expect(html).toContain(`Heraklion ${separator === '->' ? '-&gt;' : separator} Berlin</a><a class="remote-link-popover"`)
      expect(html).toContain('</span> and bla bla')
    }
    expect((await resolveAirports('Heraklion to Berlin'))?.map(a => a?.iata)).toEqual(['HER', 'BER'])
    expect(parseLocationQuery('#flying Heraklion via Berlin')).toBeNull()
    expect(parseLocationQuery('#flying Heraklion to')).toBeNull()
  })

  test('renders a next-line Unicode itinerary within prose, including trailing marker whitespace', () => {
    const location: LocationView = {
      query: 'Heraklion → Berlin', latitude: 35.3, longitude: 25.2,
      displayName: 'Heraklion Airport → Berlin Brandenburg Airport', url: 'https://www.openstreetmap.org/',
      preview: { imageUrl: '/uploads/flight.png', title: 'Heraklion Airport → Berlin Brandenburg Airport',
        imageWidth: 600, imageHeight: 315 },
    }
    for (const trailing of ['', ' ', '  ', '\t', ' \t ']) {
      const body = `Excited about these news! I am #flying${trailing}
Heraklion → Berlin
on Friday, going to stay for a while to work on textlog among other things. Happy because I was getting a bit depressed lately living in the mountains in Crete.`
      expect(parseLocationQuery(body)).toBe('Heraklion -> Berlin')
      const token = flyingText(body)!
      expect(body.slice(token.index, token.lastIndex)).toBe(location.query)
      const html = linkify(body, {}, [], undefined, postContentFlags(body), '', { flying: 1 }, {}, {
        signedIn: false, formPrefix: 'flight', location,
      })
      expect(html).toContain('Heraklion → Berlin</a><a class="remote-link-popover"')
      expect(html).toContain('on Friday, going to stay for a while')
    }
  })

  test('parses inline and next-line itineraries and ignores code', () => {
    for (const body of ['Off we go #flying Heraklion -> Berlin', '#flying\n\nHeraklion -> Berlin']) {
      expect(parseLocationQuery(body)).toBe('Heraklion -> Berlin')
      const token = flyingText(body)!
      expect(body.slice(token.index, token.lastIndex)).toBe(token.query)
    }
    expect(parseLocationQuery('#flying HER → BER')).toBe('HER -> BER')
    for (const body of ['`#flying HER -> BER`', '```\n#flying HER -> BER\n```', '#flying Berlin']) {
      expect(parseLocationQuery(body)).toBeNull()
    }
  })

  test('resolves names and codes to active commercial airports', async () => {
    expect((await resolveAirports('Heraklion -> Berlin'))?.map(a => a?.iata)).toEqual(['HER', 'BER'])
    expect((await resolveAirports('LGIR → BER'))?.map(a => a?.iata)).toEqual(['HER', 'BER'])
    expect(await resolveAirports('Nonexistent Airport xyz -> Berlin')).toBeNull()
    expect(await resolveAirports(' -> Berlin')).toBeNull()
  })

  test('Unicode and ASCII arrows share cached previews and preserve the displayed text', async () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE location_geocodes(query TEXT PRIMARY KEY,latitude REAL,longitude REAL,
        display_name TEXT,language TEXT);
      CREATE TABLE location_geocode_misses(query TEXT PRIMARY KEY);
      CREATE TABLE location_map_previews(cache_key TEXT PRIMARY KEY,image_key TEXT,width INTEGER,height INTEGER);
      INSERT INTO location_geocodes VALUES('Heraklion -> Berlin',35.2,24.2,'HER → BER','en');
      INSERT INTO location_map_previews VALUES('3:3:35.200000:24.200000:flight:Heraklion -> Berlin',
        'location-maps/test.png',600,315);
      INSERT INTO location_geocode_misses VALUES('Heraklion → Berlin'),('HER → LHR'),('Nowhere');`)
    const cached = await executeDatabaseDomain(database, 'api.cachedLocation', { query: 'Heraklion → Berlin' })
    expect(cached).toMatchObject({ query: 'Heraklion → Berlin', imageKey: 'location-maps/test.png' })
    database.run(`UPDATE location_geocodes SET query='Heraklion → Berlin';
      UPDATE location_map_previews SET cache_key='3:3:35.200000:24.200000:flight:Heraklion → Berlin';`)
    expect(await executeDatabaseDomain(database, 'api.cachedLocation', { query: 'Heraklion -> Berlin' }))
      .toMatchObject({ query: 'Heraklion -> Berlin', imageKey: 'location-maps/test.png' })
    const origin = { latitude: 35.2, longitude: 24.2, displayName: 'HER → BER' }
    expect(locationCacheKey({ ...origin, query: 'Heraklion → Berlin' }))
      .toBe(locationCacheKey({ ...origin, query: 'Heraklion -> Berlin' }))
    expect(await executeDatabaseDomain(database, 'api.cachedLocation', { query: 'HER → LHR' })).toBeNull()
    expect(await executeDatabaseDomain(database, 'api.cachedLocation', { query: 'Nowhere' })).toBe('miss')
    expect(await executeDatabaseDomain(database, 'api.cacheLocation', { query: 'HER → CDG', location: null }))
      .toBeNull()
    expect(database.query('SELECT 1 FROM location_geocode_misses WHERE query=?').get('HER → CDG')).toBeNull()
    database.close()
  })

  test('separates routes from the same airport in map caches', () => {
    const origin = { latitude: 35.3, longitude: 25.2, displayName: 'Heraklion' }
    expect(locationCacheKey({ ...origin, query: 'HER -> BER' }))
      .not.toBe(locationCacheKey({ ...origin, query: 'HER -> LHR' }))
  })

  test('renders the itinerary with the existing hover card', () => {
    const html = linkify('#flying Heraklion -> Berlin', {}, [], undefined, undefined, '', { flying: 1 }, {}, {
      signedIn: false, formPrefix: 'flight', location: {
        query: 'Heraklion -> Berlin', latitude: 35.3, longitude: 25.2,
        displayName: 'Heraklion Airport → Berlin Brandenburg Airport', url: 'https://www.openstreetmap.org/',
        preview: { imageUrl: '/uploads/flight.png', title: 'Heraklion Airport → Berlin Brandenburg Airport',
          imageWidth: 600, imageHeight: 315 },
      },
    })
    expect(html).toContain('href="/tag/flying">#flying</a>')
    expect(html).toContain('Heraklion -&gt; Berlin</a><a class="remote-link-popover"')
    expect(html).toContain('Heraklion Airport → Berlin Brandenburg Airport')
  })
})
