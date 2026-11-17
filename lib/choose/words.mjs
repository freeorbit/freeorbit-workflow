// Words the choice pages share.

/** A count with its noun: "1 commit", "3 commits". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
