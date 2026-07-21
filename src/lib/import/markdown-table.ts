export function escapeMarkdownTableCell(cell: string): string {
  return cell.replace(/\|/g, "\\|");
}
