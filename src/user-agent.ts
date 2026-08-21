const mobileUserAgent = /(?:Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile)/i

export function isMobileRequest(request: Request) {
  return mobileUserAgent.test(request.headers.get('user-agent') || '')
}
