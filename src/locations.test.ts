import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { apiPost } from './api'
import { geocodeLocation, locationDestination, locationMapProvider, parseLocationQuery } from './locations'
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
    expect(database.query('SELECT * FROM post_locations').get()).toEqual({ post_id: 1,
      query: 'Kallikratis, Crete', latitude: 35.2, longitude: 24.2,
      display_name: 'Kallikratis, Sfakia, Crete, Greece' })
  })

  test('handles an empty geocoding result without throwing', async () => {
    const fetcher = (() => Promise.resolve(new Response('[]', {
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
      postId: 1, query: 'Nowhere', location: null,
    })).toBeNull()
  })

  test('renders the location with the existing OG-style preview', () => {
    const location: LocationView = { query: 'Kallikratis, Crete', latitude: 35.2, longitude: 24.2,
      displayName: 'Kallikratis, Sfakia, Crete, Greece',
      url: 'https://www.openstreetmap.org/?mlat=35.2&mlon=24.2#map=3/35.2/24.2', preview: {
        imageUrl: '/uploads/location-maps/test.png', title: 'Kallikratis',
        description: 'Sfakia, Crete, Greece', imageWidth: 600, imageHeight: 315,
      } }
    const html = linkify('Going hiking #map\nKallikratis, Crete', {}, [], undefined, undefined, '',
      { map: 1 }, {}, { signedIn: false, formPrefix: 'post-1', location })
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
      INSERT INTO location_map_previews VALUES('3:2:35.200000:24.200000','location-maps/test.png',600,315);`)
    const apiLocation = apiPost(database, 1, 'https://textlog.example')?.location
    expect(apiLocation).toMatchObject({
      query: 'Kallikratis, Crete', latitude: 35.2, longitude: 24.2,
      preview: { imageUrl: '/uploads/location-maps/test.png', title: 'Kallikratis' },
    })
    expect(apiLocation?.preview.siteName).toBeUndefined()
  })
})
