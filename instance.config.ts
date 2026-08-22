export type InstanceConfiguration = {
  operator: {
    name: string
    url: string | null
    email: string | null
    phone: { display: string; url: string } | null
    address: string | null
    hours: string | null
  }
  fiscalHost: {
    name: string
    legalName: string
    url: string
    address: string
  } | null
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
    name: 'textlog collective',
    url: 'https://opencollective.com/textlog',
    email: 'hello@textlog.cc',
    phone: null,
    address: null,
    hours: null,
  },
  fiscalHost: {
    name: 'Open Source Europe',
    legalName: 'Open Collective Europe ASBL',
    url: 'https://opencollective.com/europe',
    address: 'Avenue Louise 500, 1000 Brussels, Belgium',
  },
  administrators: ['gstagas@gmail.com', 'lamprou@live.com'],
  privacyAuthority: {
    name: 'Belgian Data Protection Authority',
    url: 'https://www.dataprotectionauthority.be/citizen',
    address: 'Rue de la Presse 35, 1000 Brussels, Belgium',
  },
  links: {
    getMobileApp: 'https://github.com/Faultless/textlog_flutter/releases',
    irc: 'ircs://irc.libera.chat/#textlog',
    github: 'https://github.com/stagas/textlog',
    donate: 'https://opencollective.com/textlog',
  },
}
