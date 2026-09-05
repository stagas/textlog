import {
  FaFacebookMessenger,
  FaInstagram,
  FaTelegram,
  FaThreads,
  FaWhatsapp,
  FaXTwitter,
} from 'react-icons/fa6'
import React from 'react'
import type { IconType } from 'react-icons'
import { renderToStaticMarkup } from 'react-dom/server'

const shareUrl = 'https://textlog.cc'
const shareMessage = 'Come join me on textlog — a quieter place to write, share, and connect.'
const encodedUrl = encodeURIComponent(shareUrl)
const encodedMessage = encodeURIComponent(shareMessage)
const encodedMessageWithUrl = encodeURIComponent(`${shareMessage} ${shareUrl}`)

const socialShares = [
  { name: 'Telegram', Icon: FaTelegram, href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}` },
  { name: 'WhatsApp', Icon: FaWhatsapp, href: `https://wa.me/?text=${encodedMessageWithUrl}` },
  { name: 'Instagram', Icon: FaInstagram, href: 'https://www.instagram.com/direct/new/' },
  { name: 'Messenger', Icon: FaFacebookMessenger, href: 'https://www.messenger.com/new/' },
  { name: 'Threads', Icon: FaThreads, href: `https://www.threads.net/intent/post?text=${encodedMessageWithUrl}` },
  { name: 'X', Icon: FaXTwitter, href: `https://x.com/intent/post?text=${encodedMessage}&url=${encodedUrl}` },
]

function renderedIcon(Icon: IconType) {
  return { __html: renderToStaticMarkup(React.createElement(Icon, { 'aria-hidden': 'true' })) }
}

export function InviteShare() {
  return (
    <section className="invite-share" aria-labelledby="invite-share-heading">
      <h3 id="invite-share-heading">or share with friends</h3>
      <div className="invite-share-links">
        {socialShares.map(({ name, Icon, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Share textlog on ${name}`} title={name}
            key={name}
          >
            <span className="invite-share-icon" aria-hidden="true"
              dangerouslySetInnerHTML={renderedIcon(Icon)} />
          </a>
        ))}
      </div>
      <p className="invite-share-copy" tabIndex={0} title="Select invitation text">
        {shareMessage} {shareUrl}
      </p>
    </section>
  )
}
