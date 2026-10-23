import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OpenAI 호환 /embeddings 엔드포인트로 텍스트를 벡터화한다 (기본은 OpenRouter, OpenAI·Azure·Ollama·vLLM 등도 가능).
 * 결과 차원은 drive_folders/drive_items의 vector 차원(EMBEDDING_DIMENSIONS)과 같아야 한다.
 */
@Injectable()
export class EmbeddingService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('EMBEDDING_API_KEY');
    this.baseUrl = config.getOrThrow<string>('EMBEDDING_BASE_URL');
    this.model = config.getOrThrow<string>('EMBEDDING_MODEL');
    this.dimensions = config.getOrThrow<number>('EMBEDDING_DIMENSIONS');
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // 잘못된 키·모델 ID·크레딧 부족 등을 로그에서 구분할 수 있도록 응답 본문 일부를 붙인다.
      const detail = await res.text().catch(() => '');
      throw new Error(
        `embedding API ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`,
      );
    }

    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    const vector = json.data?.[0]?.embedding;
    if (!vector || vector.length !== this.dimensions) {
      throw new Error('embedding 차원이 EMBEDDING_DIMENSIONS와 다릅니다.');
    }
    return vector;
  }
}
