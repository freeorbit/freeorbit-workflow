// How monday keeps a comment's HTML, for the board tests' fakes, as Atlas
// NX's board and a probe on a personal board showed on 2026-11-20: <code>
// dropped with its words kept, every other tag kept, and a text_body with
// the tags gone, the entities decoded, and each list item a "* " line.

/** What monday keeps of `html`, as { body, text_body }; `drop` names the tags it loses. */
export function asMondayKeeps(html, drop = ["code"]) {
  const body = drop.reduce((text, tag) => text.replace(new RegExp(`</?${tag}\\b[^>]*>`, "g"), ""), String(html)).replace(/&nbsp;/g, " ");
  const text = body
    .replace(/<li>/g, "* ")
    .replace(/<\/(p|li|blockquote)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n+$/, "");
  return { body, text_body: text };
}

/** monday's answer to `updates(ids:)` over a fake's items: each update asked for that it holds, a reply's too. */
export const updatesFor = (items, ids) => items.flatMap((item) => (item.updates ?? []).flatMap((update) => [update, ...(update.replies ?? [])])).filter((update) => ids.includes(update.id));
