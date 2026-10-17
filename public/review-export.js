function csvCell(value) {
  let text = value === undefined || value === null ? '' : String(value);
  // Neutralize spreadsheet formula prefixes, including leading whitespace.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildReviewCsv(candidates, reviewFor) {
  const header = ['pair_id','kind','left_id','right_id','left_row','right_row','left_vendor','right_vendor','currency','left_amount','right_amount','left_date','right_date','left_description','right_description','similarity','reason','review_decision','review_note'];
  const rows = candidates.map((pair) => {
    const review = reviewFor(pair.id);
    return [pair.id,pair.kind,pair.left.id,pair.right.id,pair.left.sourceRow,pair.right.sourceRow,pair.left.vendor,pair.right.vendor,pair.left.currency,pair.left.amount,pair.right.amount,pair.left.date,pair.right.date,pair.left.description,pair.right.description,pair.similarity,pair.reason,review.decision,review.note];
  });
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
