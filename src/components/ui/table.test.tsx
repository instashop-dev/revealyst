// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Table } from "./table";

// T2.6 item 8 — regression pin: wide tables must stay horizontally
// scrollable inside their own container rather than blowing out the page
// (the shell has no other overflow guard). This asserts the wrapper div
// class directly so the fix can't silently regress in a future refactor.
describe("Table — overflow-x wrapper (a11y/responsive regression pin)", () => {
  it("wraps the <table> in a div with overflow-x-auto", () => {
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </Table>,
    );
    const wrapper = container.querySelector('[data-slot="table-container"]');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.className).toContain("overflow-x-auto");
  });
});
