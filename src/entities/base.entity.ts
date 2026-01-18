import { OptionalProps, PrimaryKey, Property } from "@mikro-orm/core";
import { v4 as uuid } from "uuid";

export abstract class BaseEntity {
  [OptionalProps]?: "createdAt" | "updatedAt";
  @PrimaryKey()
  id: string = uuid();

  @Property({ columnType: "timestamptz", onCreate: () => new Date() })
  createdAt!: Date;

  @Property({
    columnType: "timestamptz",
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}
