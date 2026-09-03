declare module 'wordnet' {
  const wordnet: {
    init(databaseDirectory?: string): Promise<void>
    lookup(word: string, skipPointers?: boolean): Promise<unknown[]>
    list(): string[]
  }
  export default wordnet
}

declare module 'wordnet-db' {
  const database: { path: string }
  export default database
}
