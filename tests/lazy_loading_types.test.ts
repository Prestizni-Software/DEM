import {
  EntityDescriptor,
  LazyLoadingOptions,
  ServerResponse,
} from "../CommonTypes.js";
import { AutoUpdatedClientObject } from "../AutoUpdatedClientObjectClass.js";
import { classProp } from "../CommonTypes.js";

class SampleTask {
  @classProp
  public title!: string;

  @classProp
  public status!: string;

  public static getDescriptor(data: Partial<SampleTask>): string {
    return `[${data.status ?? "unknown"}] ${data.title ?? "untitled"}`;
  }
}

class DefaultSampleEntity {
  @classProp
  public name!: string;
}

describe("Smart Lazy Loading Type and Descriptor Contracts", () => {
  it("should validate EntityDescriptor structure", () => {
    const descriptor: EntityDescriptor = {
      _id: "60d5ec49f1b2c8b1f8e4e1a1",
      description: "Sample Description",
    };
    expect(descriptor._id).toBe("60d5ec49f1b2c8b1f8e4e1a1");
    expect(descriptor.description).toBe("Sample Description");
  });

  it("should validate LazyLoadingOptions structure", () => {
    const options: LazyLoadingOptions = {
      enabled: true,
      defaultDepth: 2,
    };
    expect(options.enabled).toBe(true);
    expect(options.defaultDepth).toBe(2);
  });

  it("should allow status 'lazy' and manifest in ServerResponse startup payload", () => {
    const response: ServerResponse<{
      status: "up-to-date" | "delta" | "full" | "lazy";
      ids: string[];
      manifest?: EntityDescriptor[];
    }> = {
      success: true,
      data: {
        status: "lazy",
        ids: ["id1", "id2"],
        manifest: [
          { _id: "id1", description: "Item 1" },
          { _id: "id2", description: "Item 2" },
        ],
      },
    };
    expect(response.data.status).toBe("lazy");
    expect(response.data.manifest).toHaveLength(2);
  });

  it("should return stringified data as fallback from AutoUpdatedClientObject.getDescriptor", () => {
    const fallbackDesc = AutoUpdatedClientObject.getDescriptor({
      name: "Default Test",
      value: 123,
    });
    expect(fallbackDesc).toBe(JSON.stringify({ name: "Default Test", value: 123 }));
  });

  it("should allow entity subclasses to override static getDescriptor", () => {
    const desc = SampleTask.getDescriptor({
      title: "Fix bug",
      status: "archived",
    });
    expect(desc).toBe("[archived] Fix bug");
  });
});
