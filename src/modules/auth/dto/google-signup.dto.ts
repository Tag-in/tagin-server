import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class GoogleSignupDto {
  /** Google Sign-In으로 클라이언트가 발급받은 ID Token (가입 시 서버가 다시 검증) */
  @IsString()
  @IsNotEmpty()
  idToken: string;

  /** 이용약관 동의 (필수, true만 허용) */
  @Equals(true, { message: '이용약관에 동의해야 합니다.' })
  termsAgreed: boolean;

  /** 개인정보 수집·이용 동의 (필수, true만 허용) */
  @Equals(true, { message: '개인정보 수집·이용에 동의해야 합니다.' })
  privacyAgreed: boolean;

  /**
   * 마케팅 정보 수신 동의 (선택, 생략 시 false)
   * @example false
   */
  @IsOptional()
  @IsBoolean()
  marketingAgreed?: boolean;
}
