// @Type()은 reflect-metadata가 필요하다. 런타임에서는 Nest가 먼저 로드한다.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchDriveItemsDto } from './search-drive-items.dto.js';

const errorsOf = async (query: Record<string, string>) => {
  const dto = plainToInstance(SearchDriveItemsDto, query);
  return { dto, errors: await validate(dto) };
};

describe('SearchDriveItemsDto', () => {
  it('쿼리 문자열의 limit을 숫자로 바꾸고 검색어 공백을 제거한다', async () => {
    const { dto, errors } = await errorsOf({
      q: '  매출 보고서 ',
      folderId: '5f8c1a3e-2b4d-4e6f-8a9b-0c1d2e3f4a5b',
      limit: '10',
    });
    expect(errors).toHaveLength(0);
    expect(dto.q).toBe('매출 보고서');
    expect(dto.limit).toBe(10);
  });

  it('공백뿐인 검색어는 거부한다', async () => {
    const { errors } = await errorsOf({ q: '   ' });
    expect(errors.map((e) => e.property)).toEqual(['q']);
  });

  it('UUID가 아닌 folderId와 범위를 벗어난 limit은 거부한다', async () => {
    const { errors } = await errorsOf({
      q: '매출',
      folderId: 'not-a-uuid',
      limit: '51',
    });
    expect(errors.map((e) => e.property).sort()).toEqual(['folderId', 'limit']);
  });
});
