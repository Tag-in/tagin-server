import type { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../embedding.service.js';

describe('EmbeddingService', () => {
  const env: Record<string, unknown> = {
    EMBEDDING_API_KEY: 'test-key',
    EMBEDDING_BASE_URL: 'https://embeddings.test/v1',
    EMBEDDING_MODEL: 'test-model',
    EMBEDDING_DIMENSIONS: 3,
  };
  const config = { getOrThrow: (key: string) => env[key] };
  const service = new EmbeddingService(config as unknown as ConfigService);
  const fetchMock = vi.fn();

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('설정한 모델·차원으로 요청하고 벡터를 반환한다', async () => {
    respond(200, { data: [{ embedding: [0.1, 0.2, 0.3] }] });

    await expect(service.embed('매출')).resolves.toEqual([0.1, 0.2, 0.3]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://embeddings.test/v1/embeddings');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body)).toEqual({
      model: 'test-model',
      input: '매출',
      dimensions: 3,
    });
  });

  it('API 오류 응답이면 실패한다', async () => {
    respond(429, { error: 'rate limited' });
    await expect(service.embed('매출')).rejects.toThrow('embedding API 429');
  });

  it('API 오류 응답 본문을 에러 메시지에 포함한다', async () => {
    respond(401, { error: { message: 'No auth credentials found' } });
    await expect(service.embed('매출')).rejects.toThrow(
      'embedding API 401 {"error":{"message":"No auth credentials found"}}',
    );
  });

  it('차원이 설정과 다르면 실패한다', async () => {
    respond(200, { data: [{ embedding: [0.1, 0.2] }] });
    await expect(service.embed('매출')).rejects.toThrow('차원');
  });
});
