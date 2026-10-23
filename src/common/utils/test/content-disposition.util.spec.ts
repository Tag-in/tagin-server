import { attachmentDisposition } from '../content-disposition.util.js';

describe('attachmentDisposition', () => {
  it('ASCII 파일명은 그대로 쓴다', () => {
    expect(attachmentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('한글 파일명은 filename*에 퍼센트 인코딩하고 filename은 ASCII로 대체한다', () => {
    const header = attachmentDisposition('분기 매출.pdf');

    expect(header).toContain('filename="__ __.pdf"');
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent('분기 매출.pdf')}`,
    );
  });

  it('따옴표·역슬래시는 헤더를 깨지 않도록 대체한다', () => {
    expect(attachmentDisposition('a"b\\c.txt')).toContain(
      'filename="a_b_c.txt"',
    );
  });

  it("filename*에서 허용되지 않는 ' ( ) *를 인코딩한다", () => {
    expect(attachmentDisposition("it's (1)*.txt")).toContain(
      "filename*=UTF-8''it%27s%20%281%29%2A.txt",
    );
  });
});
