import { IsString, IsNotEmpty } from "class-validator";

export class CreateMemoDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
