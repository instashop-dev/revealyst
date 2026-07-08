import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../src/lib/email";

const CONFIGURED = {
  SES_ACCESS_KEY_ID: "AKIAEXAMPLE",
  SES_SECRET_ACCESS_KEY: "secret",
  SES_REGION: "us-east-1",
  EMAIL_FROM: "Revealyst <noreply@revealyst.com>",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendEmail", () => {
  it("no-ops (and warns) when SES is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      sendEmail(
        {},
        { to: "x@example.com", subject: "Hi", html: "<p>link</p>" },
      ),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("POSTs a well-formed SES v2 request when configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await sendEmail(CONFIGURED, {
      to: "dest@example.com",
      subject: "Confirm your Revealyst email",
      html: "<p>hello</p>",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0][0] as Request;
    expect(request.url).toBe(
      "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
    );
    // aws4fetch signs the request — Authorization must be present.
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
    const body = JSON.parse(await request.text());
    expect(body.FromEmailAddress).toBe(CONFIGURED.EMAIL_FROM);
    expect(body.Destination.ToAddresses).toEqual(["dest@example.com"]);
    expect(body.Content.Simple.Subject.Data).toBe(
      "Confirm your Revealyst email",
    );
    expect(body.Content.Simple.Body.Html.Data).toBe("<p>hello</p>");
  });

  it("throws on a non-2xx SES response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad", { status: 400 }),
    );
    await expect(
      sendEmail(CONFIGURED, {
        to: "dest@example.com",
        subject: "x",
        html: "y",
      }),
    ).rejects.toThrow(/SES send failed/);
  });
});
