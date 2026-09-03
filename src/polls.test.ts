import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { loadPolls, parsePoll, pollDisplayBody, syncPoll, voteInPoll } from './polls'

describe('polls', () => {
  test('parses a question followed by the poll marker and options', () => {
    expect(parsePoll('Tea or coffee?\n#poll\nTea\nCoffee')).toEqual({
      question: 'Tea or coffee?',
      options: ['Tea', 'Coffee'],
    })
    expect(parsePoll('Not a poll\n#poll\nOnly one')).toBeNull()
    expect(parsePoll('Best OS? #poll\nWindows\nMacOS\nLinux')).toEqual({
      question: 'Best OS?',
      options: ['Windows', 'MacOS', 'Linux'],
    })
    expect(parsePoll('Tea or coffee? #poll\nTea\nCoffee\n\nI usually drink mine in the morning.')).toEqual({
      question: 'Tea or coffee?',
      options: ['Tea', 'Coffee'],
      after: 'I usually drink mine in the morning.',
    })
  })

  test('does not activate a poll marker inside fenced code', () => {
    expect(parsePoll('Example:\n```text\n#poll\nTea\nCoffee\n```')).toBeNull()
  })

  test('parses a quiz with exactly one marked correct answer', () => {
    expect(parsePoll('Capital of Greece? #quiz\nRome\n> Athens\nParis')).toEqual({
      question: 'Capital of Greece?',
      options: ['Rome', 'Athens', 'Paris'],
      kind: 'quiz',
      correctIndex: 1,
    })
    expect(parsePoll('Invalid #quiz\n> One\n> Two')).toBeNull()
    expect(parsePoll('Invalid #quiz\nOne\nTwo')).toBeNull()
    expect(parsePoll('Capital? #quiz\nRome\n> Athens\n\nAthens has been the capital since 1834.')).toEqual({
      question: 'Capital?',
      options: ['Rome', 'Athens'],
      kind: 'quiz',
      correctIndex: 1,
      explanation: 'Athens has been the capital since 1834.',
    })
  })

  test('keeps quiz answers and explanations out of the display body', () => {
    expect(
      pollDisplayBody('Capital of Greece? #quiz\nRome\n> Athens\nParis\n\nAthens has been the capital since 1834.'),
    )
      .toBe('Capital of Greece? #quiz')
  })

  test('quizzes do not expire', () => {
    const db = new Database(':memory:')
    db.run(`CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,body TEXT,created_at TEXT,deleted_at TEXT);
      CREATE TABLE blocks(blocker_id INTEGER,blocked_id INTEGER);
      CREATE TABLE post_hashtags(post_id INTEGER,tag TEXT);
      CREATE TABLE blocked_hashtags(user_id INTEGER,tag TEXT);
      CREATE TABLE poll_options(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER,position INTEGER,label TEXT);
      CREATE TABLE poll_votes(post_id INTEGER,option_id INTEGER,user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(post_id,user_id));
      INSERT INTO users VALUES(1);
      INSERT INTO posts VALUES(1,1,'Old quiz #quiz\n> Yes\nNo','2000-01-01 00:00:00',NULL);`)
    syncPoll(db, 1, 'Old quiz #quiz\n> Yes\nNo')
    const quiz = loadPolls(db, [1], 1).get(1)!
    expect(quiz).toMatchObject({ kind: 'quiz', expired: false, expiresAt: null })
    expect(voteInPoll(db, 1, quiz.options[0].id, 1)).toBe('ready')
  })

  test('allows one vote per user and reveals totals to that voter', () => {
    const db = new Database(':memory:')
    db.run(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,body TEXT,created_at TEXT,deleted_at TEXT);
      CREATE TABLE blocks(blocker_id INTEGER,blocked_id INTEGER);
      CREATE TABLE post_hashtags(post_id INTEGER,tag TEXT);
      CREATE TABLE blocked_hashtags(user_id INTEGER,tag TEXT);
      CREATE TABLE poll_options(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER REFERENCES posts(id),
        position INTEGER,label TEXT,UNIQUE(post_id,position));
      CREATE TABLE poll_votes(post_id INTEGER REFERENCES posts(id),option_id INTEGER REFERENCES poll_options(id),
        user_id INTEGER REFERENCES users(id),created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,user_id));
      INSERT INTO users VALUES(1); INSERT INTO posts VALUES(1,1,'',CURRENT_TIMESTAMP,NULL);`)
    syncPoll(db, 1, 'Tea or coffee?\n#poll\nTea\nCoffee')
    const poll = loadPolls(db, [1], 1).get(1)!
    expect(voteInPoll(db, 1, poll.options[0].id, 1)).toBe('ready')
    expect(voteInPoll(db, 1, poll.options[1].id, 1)).toBe('already_voted')
    expect(loadPolls(db, [1], 1).get(1)).toMatchObject({ totalVotes: 1, viewerVoted: true,
      options: [{ votes: 1, selected: true }, { votes: 0, selected: false }] })
  })
})
