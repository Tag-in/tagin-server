/** 소셜 provider에서 검증된 프로필 (가입/로그인 입력) */
export interface SocialProfile {
  providerUserId: string;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
}

export interface SignupConsents {
  marketingAgreed: boolean;
}
