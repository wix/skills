import { describe, it, expect } from 'vitest';
import { parseReEvalCommand } from '../src/parse-re-eval-command';

describe('parseReEvalCommand', () => {
  it.each([
    ['/re-eval', 'the bare command'],
    ['/re-eval flaked on the poll again', 'trailing text as a note'],
    ['  /re-eval  ', 'surrounding whitespace'],
    ['/RE-EVAL', 'upper case'],
    ['/re-eval\n\nthe 403 again', 'a note on later lines'],
  ])('treats %j as a command (%s)', (body) => {
    expect(parseReEvalCommand(body)).toEqual({ isCommand: true });
  });

  // Each of these would turn ordinary PR conversation into a paid eval run.
  it.each([
    ['please /re-eval this', 'mid-sentence'],
    ['> /re-eval', 'a quoted comment'],
    ['```\n/re-eval\n```', 'inside a code fence'],
    ['I think /re-eval is the fix', 'discussing the feature'],
    ['/re-evaluate', 'a longer token that merely starts the same'],
    ['', 'an empty body'],
    ['nothing to do with it', 'an unrelated comment'],
  ])('does not treat %j as a command (%s)', (body) => {
    expect(parseReEvalCommand(body)).toEqual({ isCommand: false });
  });
});
