import { Injectable } from "@nestjs/common";
import { ProviderDriver } from "./provider.interface";

@Injectable()
export class ProviderRegistry {
  private drivers = new Map<string, ProviderDriver>();
  register(driver: ProviderDriver) {
    this.drivers.set(driver.key, driver);
  }
  get(key: string) {
    const d = this.drivers.get(key);
    if (!d) throw new Error(`driver ${key} not found`);
    return d;
  }
  listAllDrivers() {
    return Array.from(this.drivers.values());
  }
  removeDriver(key: string) {
    this.drivers.delete(key);
  }
}
