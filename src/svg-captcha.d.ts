declare module 'svg-captcha' {
  const captcha: {
    create(options?: { size?: number; noise?: number; color?: boolean; background?: string }): {
      data: string
      text: string
    }
  }
  export default captcha
}
