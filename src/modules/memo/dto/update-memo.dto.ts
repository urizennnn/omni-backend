import { IsString, IsNotEmpty } from "class-validator";

export class UpdateMemoDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
