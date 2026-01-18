interface TelegramTextEntity {
  _: string;
  offset: number;
  length: number;
  type?: string;
  url?: string;
  language?: string;
  user_id?: number;
}

interface TelegramFormattedText {
  text: string;
  entities?: TelegramTextEntity[];
}

export function convertTelegramToMarkdown(
  formattedText: TelegramFormattedText | undefined,
): string {
  if (!formattedText || !formattedText.text) {
    return "";
  }

  const { text, entities } = formattedText;

  if (!entities || entities.length === 0) {
    return text;
  }

  const sortedEntities = [...entities].sort((a, b) => {
    if (a.offset !== b.offset) {
      return a.offset - b.offset;
    }
    return b.length - a.length;
  });

  const chars = Array.from(text);
  const markers: Array<{ pos: number; marker: string; isClosing: boolean }> =
    [];

  for (const entity of sortedEntities) {
    const start = entity.offset;
    const end = entity.offset + entity.length;

    let openMarker = "";
    let closeMarker = "";

    switch (entity._) {
      case "textEntityTypeBold":
        openMarker = "**";
        closeMarker = "**";
        break;
      case "textEntityTypeItalic":
        openMarker = "_";
        closeMarker = "_";
        break;
      case "textEntityTypeCode":
        openMarker = "`";
        closeMarker = "`";
        break;
      case "textEntityTypePre":
      case "textEntityTypePreCode":
        if (entity.language) {
          openMarker = `\n\`\`\`${entity.language}\n`;
          closeMarker = "\n```\n";
        } else {
          openMarker = "\n```\n";
          closeMarker = "\n```\n";
        }
        break;
      case "textEntityTypeStrikethrough":
        openMarker = "~~";
        closeMarker = "~~";
        break;
      case "textEntityTypeUnderline":
        openMarker = "__";
        closeMarker = "__";
        break;
      case "textEntityTypeTextUrl":
        if (entity.url) {
          openMarker = "[";
          closeMarker = `](${entity.url})`;
        }
        break;
      case "textEntityTypeUrl":
        break;
      case "textEntityTypeMention":
      case "textEntityTypeMentionName":
        break;
      case "textEntityTypeHashtag":
      case "textEntityTypeCashtag":
      case "textEntityTypeBotCommand":
      case "textEntityTypeEmailAddress":
      case "textEntityTypePhoneNumber":
      case "textEntityTypeBankCardNumber":
        break;
      default:
        break;
    }

    if (openMarker) {
      markers.push({ pos: start, marker: openMarker, isClosing: false });
    }
    if (closeMarker) {
      markers.push({ pos: end, marker: closeMarker, isClosing: true });
    }
  }

  markers.sort((a, b) => {
    if (a.pos !== b.pos) {
      return a.pos - b.pos;
    }
    if (a.isClosing !== b.isClosing) {
      return a.isClosing ? 1 : -1;
    }
    return 0;
  });

  let result = "";
  let lastPos = 0;

  for (const marker of markers) {
    if (marker.pos > lastPos) {
      result += chars.slice(lastPos, marker.pos).join("");
    }
    result += marker.marker;
    lastPos = marker.pos;
  }

  if (lastPos < chars.length) {
    result += chars.slice(lastPos).join("");
  }

  return result;
}

export function getPlainText(
  formattedText: TelegramFormattedText | undefined,
): string {
  if (!formattedText || !formattedText.text) {
    return "";
  }
  return formattedText.text;
}
