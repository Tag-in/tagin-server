import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OpenAI 호환 /embeddings 엔드포인트로 텍스트를 벡터화한다 (OpenAI, Azure, Ollama, vLLM 등).
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
    if (!res.ok) throw new Error(`embedding API ${res.status}`);

    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    const vector = json.data?.[0]?.embedding;
    if (!vector || vector.length !== this.dimensions) {
      throw new Error('embedding 차원이 EMBEDDING_DIMENSIONS와 다릅니다.');
    }
    return vector;
  }
}
