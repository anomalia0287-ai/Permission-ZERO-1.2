const PAGE_CHARACTER_BUDGET = 110

/**
 * Long messages read as a wall when dumped at once, so the popup pages them
 * by sentence. Presentation-only: the stored message stays one record, and
 * the confirm command only fires on the last page.
 */
export function paginateCommunicationMessage(message: string): string[] {
  const sentences = message.match(/[^.!?…]+[.!?…]*\s*/g) ?? [message]
  const pages: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && (current + sentence).length > PAGE_CHARACTER_BUDGET) {
      pages.push(current.trim())
      current = sentence
    } else {
      current += sentence
    }
  }
  if (current.trim()) pages.push(current.trim())
  return pages.length > 0 ? pages : [message]
}
