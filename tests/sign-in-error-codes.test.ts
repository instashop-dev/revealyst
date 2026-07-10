import { describe, expect, it } from "vitest";
import {
  describeAuthRedirectError,
  splitNextError,
} from "../src/app/sign-in/error-codes";

describe("describeAuthRedirectError", () => {
  it("maps the OAuth callback codes users can hit", () => {
    expect(describeAuthRedirectError("access_denied")).toMatch(/cancelled/);
    expect(describeAuthRedirectError("state_not_found")).toMatch(/try again/);
    expect(describeAuthRedirectError("state_mismatch")).toMatch(/try again/);
    expect(describeAuthRedirectError("email_not_found")).toMatch(
      /email address/,
    );
  });

  it("maps the email-verification link codes (uppercase, better-auth BASE_ERROR_CODES)", () => {
    expect(describeAuthRedirectError("TOKEN_EXPIRED")).toMatch(/expired/);
    expect(describeAuthRedirectError("INVALID_TOKEN")).toMatch(
      /invalid or was already used/,
    );
    expect(describeAuthRedirectError("USER_NOT_FOUND")).toMatch(
      /couldn't find an account/,
    );
  });

  it("echoes unknown MACHINE codes but never free text (reflected-input guard)", () => {
    expect(describeAuthRedirectError("some_new_code")).toContain(
      "(some_new_code)",
    );
    // Free text / URLs / spaces must not be reflected into trusted error UI.
    expect(
      describeAuthRedirectError("account suspended - see evil.example"),
    ).toBe("Sign-in failed. Please try again.");
    expect(describeAuthRedirectError("a".repeat(41))).toBe(
      "Sign-in failed. Please try again.",
    );
  });
});

describe("splitNextError", () => {
  it("extracts an error code embedded in next's query and cleans it", () => {
    expect(splitNextError("/dashboard?error=TOKEN_EXPIRED")).toEqual({
      next: "/dashboard",
      error: "TOKEN_EXPIRED",
    });
  });

  it("preserves the rest of next's query and hash", () => {
    expect(
      splitNextError("/invite/tok_1?error=INVALID_TOKEN&tab=members#top"),
    ).toEqual({ next: "/invite/tok_1?tab=members#top", error: "INVALID_TOKEN" });
  });

  it("passes through a next without an embedded error", () => {
    expect(splitNextError("/dashboard")).toEqual({
      next: "/dashboard",
      error: null,
    });
    expect(splitNextError("/invite/tok_1?tab=x")).toEqual({
      next: "/invite/tok_1?tab=x",
      error: null,
    });
  });
});
