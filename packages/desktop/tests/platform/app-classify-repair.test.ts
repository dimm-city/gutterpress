/**
 * Opening a book (`app/classify-project`, the first call of the open sequence,
 * before the editor reads a file or a build starts) puts an interrupted
 * revision switch right and hands the author the message (issue #502).
 */
import { afterEach, expect, test } from "bun:test";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
import { POST as classify } from "../../src/routes/api/app/classify-project/+server";

const DIR = "/abs/project";
const request = () =>
  new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify({ projectDir: DIR }),
    headers: { "content-type": "application/json" },
  });

function lib(extra: Record<string, unknown>, order: string[]): void {
  setLibForTests({
    detectProjectSource: async () => {
      order.push("detect");
      return { type: "plain-folder" };
    },
    capabilitiesFor: () => ({}),
    hasProjectManifest: () => true,
    ...extra,
  } as unknown as Partial<LibModule>);
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

test("repairs first, then reports the message once", async () => {
  registerHostServices(makeHostServices({}));
  const order: string[] = [];
  lib(
    {
      repairInterruptedSwitch: async () => void order.push("repair"),
      takeSwitchRepairNotice: async () => "put back",
    },
    order,
  );
  const body = await (await classify({ request: request() } as never)).json();
  expect(order).toEqual(["repair", "detect"]);
  expect(body.repairNotice).toBe("put back");
});

test("a repair that fails is reported, and the book still opens", async () => {
  registerHostServices(makeHostServices({}));
  lib(
    {
      repairInterruptedSwitch: async () => {
        throw new Error("boom");
      },
      takeSwitchRepairNotice: async () => null,
    },
    [],
  );
  const body = await (await classify({ request: request() } as never)).json();
  expect(body.repairNotice).toContain("could not be put back");
});

test("no notice when nothing was pending", async () => {
  registerHostServices(makeHostServices({}));
  lib({ repairInterruptedSwitch: async () => null, takeSwitchRepairNotice: async () => null }, []);
  expect("repairNotice" in (await (await classify({ request: request() } as never)).json())).toBe(false);
});
