import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  /** Google Sign-In으로 클라이언트가 발급받은 ID Token */
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
