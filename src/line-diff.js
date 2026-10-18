// Plain-text line diff. Bound both input and quadratic LCS work.
export function lineDiff(before, after) {
  const a = before.slice(0, 200000).split('\n'), b = after.slice(0, 200000).split('\n')
  if (before.length > 200000 || after.length > 200000 || a.length + b.length > 4000 || a.length * b.length > 250000) {
    return { truncated: true, lines: [] }
  }
  const width = b.length + 1, cells = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) cells[i * width + j] = a[i] === b[j] ? 1 + cells[(i + 1) * width + j + 1] : Math.max(cells[(i + 1) * width + j], cells[i * width + j + 1])
  const lines = []; let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ kind: 'same', text: a[i++] }); j++ }
    else if (j < b.length && (i === a.length || cells[i * width + j + 1] >= cells[(i + 1) * width + j])) lines.push({ kind: 'add', text: b[j++] })
    else lines.push({ kind: 'remove', text: a[i++] })
  }
  return { truncated: false, lines }
}
