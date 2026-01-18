import { IsEmail } from "class-validator";

export class CollectOnboardingEmailDto {
  @IsEmail()
  email!: string;
}
