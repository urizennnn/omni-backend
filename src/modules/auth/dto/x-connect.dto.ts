import { IsNotEmpty, IsString } from "class-validator";

export class XConnectCallbackDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  state: string;
}
