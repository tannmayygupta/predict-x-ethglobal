/**
 * Every x.com selector the extension relies on lives here (RULES 5.6). X changes its markup without notice; when
 * a feature stops appearing, this is the first file to check.
 */
export const X = {
  /** The text block of a post, where $CASHTAGS and PX#ids are read. */
  tweetText: '[data-testid="tweetText"]',
  /** One post, used to insert the bet box and read its background colour. */
  tweet: 'article[data-testid="tweet"]',
  /** Never rewrite text the user is typing. */
  editable: '[contenteditable="true"], [role="textbox"], textarea, input',
} as const;

/** Attribute our highlight spans carry; its value is the upper-case symbol. */
export const TAG_ATTR = "data-px-tag";
