const mobileUserAgent = /(?:Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile)/i

export function isMobileRequest(request: Request) {
  return mobileUserAgent.test(request.headers.get('user-agent') || '')
}

// Product versions change during routine browser updates. Banner state only needs a stable browser/platform family.
export function stableUserAgent(value: string) {
  return value.trim().slice(0, 512).replace(/\/\d+(?:[._]\d+)*/g, '/#')
}
