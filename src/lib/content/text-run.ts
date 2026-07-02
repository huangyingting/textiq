/** Rich inline text span shared by document content extraction and slide generation. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  code?: boolean;
  color?: string;
  link?: string;
}
