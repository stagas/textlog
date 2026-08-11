export type InstanceConfiguration = {
  operator: {
    name: string
    email: string | null
    phone: { display: string; url: string } | null
    address: string | null
    hours: string | null
  }
  administrators: string[]
  privacyAuthority: {
    name: string
    url: string
    address: string | null
  } | null
  links: {
    getMobileApp: string | null
    irc: string | null
    github: string | null
    donate: string | null
  }
}

// Public, instance-specific information belongs here. Secrets and deployment
// settings remain in environment variables; see .env.example.
export const instance: InstanceConfiguration = {
  operator: {
    name: 'Georgios Stagakis',
    email: 'hello@textlog.cc',
    phone: { display: '+30 694 660 0152', url: 'tel:+306946600152' },
    address: 'Kallikratis, Crete, Greece 730 11',
    hours: 'Monday–Friday, 10:00–17:00 EEST',
  },
  administrators: ['gstagas@gmail.com'],
  privacyAuthority: {
    name: 'Hellenic Data Protection Authority',
    url: 'https://www.dpa.gr/en',
    address: '1–3 Kifisias, 115 23 Athens, Greece',
  },
  links: {
    getMobileApp: 'https://github.com/Faultless/textlog_flutter',
    irc: 'ircs://irc.libera.chat/#textlog',
    github: 'https://github.com/stagas/textlog',
    donate: 'https://buymeacoffee.com/stagas',
  },
}
