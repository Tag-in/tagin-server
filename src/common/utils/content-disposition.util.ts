/**
 * 다운로드 파일명을 Content-Disposition(attachment)으로 만든다.
 * 비 ASCII 파일명은 RFC 5987(filename*)로 보내고, 이를 못 읽는 구형 클라이언트용 filename은 ASCII로 대체한다.
 */
export const attachmentDisposition = (filename: string): string => {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
};

// encodeURIComponent가 인코딩하지 않는 ' ( ) *는 filename*에서 허용되지 않아 직접 인코딩한다.
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
