import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GoogleSignupDto } from './google-signup.dto.js';

describe('GoogleSignupDto', () => {
  const valid = { idToken: 'id-token', termsAgreed: true, privacyAgreed: true };

  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(GoogleSignupDto, body))).map(
      (e) => e.property,
    );

  it('필수 약관에 동의하면 마케팅 동의 없이도 통과한다', async () => {
    await expect(errorsOf(valid)).resolves.toEqual([]);
    await expect(
      errorsOf({ ...valid, marketingAgreed: true }),
    ).resolves.toEqual([]);
  });

  it.each(['termsAgreed', 'privacyAgreed'])(
    '%s가 false이거나 없으면 거부한다',
    async (key) => {
      await expect(errorsOf({ ...valid, [key]: false })).resolves.toEqual([
        key,
      ]);
      await expect(errorsOf({ ...valid, [key]: undefined })).resolves.toEqual([
        key,
      ]);
    },
  );

  it('marketingAgreed가 boolean이 아니면 거부한다', async () => {
    await expect(
      errorsOf({ ...valid, marketingAgreed: 'yes' }),
    ).resolves.toEqual(['marketingAgreed']);
  });

  it('idToken이 비어 있으면 거부한다', async () => {
    await expect(errorsOf({ ...valid, idToken: '' })).resolves.toEqual([
      'idToken',
    ]);
  });
});
