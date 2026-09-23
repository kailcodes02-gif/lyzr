import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPeopleSearch } from "@/lib/people";
import { SearchBox } from "../search-box";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [{ homeAccountId: "x" }] }) }));

function mount(onSearch = vi.fn(), query = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SearchBox query={query} onSearch={onSearch} />
    </QueryClientProvider>
  );
  return { ...utils, onSearch, input: screen.getByRole("combobox", { name: /search mail/i }) as HTMLInputElement };
}

describe("SearchBox", () => {
  beforeEach(() => {
    localStorage.setItem("msui.mock", "1");
    resetPeopleSearch();
  });
  afterEach(() => localStorage.clear());

  it("suggests directory people for typed text and turns a pick into a from: chip and search", async () => {
    const { input, onSearch } = mount();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ani" } });
    const list = await screen.findByTestId("search-suggestions");
    const findRow = () => screen.getAllByTestId("search-person").find((r) => r.textContent?.includes("Ani Sharma"));
    await waitFor(() => expect(findRow()).toBeDefined(), { timeout: 3000 });
    const row = findRow()!;
    expect(list).toHaveTextContent("Search for");
    expect(row).toHaveTextContent("Solutions Engineer");
    fireEvent.mouseDown(row);
    expect(onSearch).toHaveBeenCalledWith('from:"ani.sharma@lyzr.ai"');
    expect(screen.getByTestId("search-chip")).toHaveTextContent("From: Ani Sharma");
    expect(input.value).toBe("");
    expect(JSON.parse(localStorage.getItem("msui.recentSearches")!)).toEqual(['from:"ani.sharma@lyzr.ai"']);
  });

  it("to: prefix suggests people as To and keeps the words before it", async () => {
    const { input, onSearch } = mount();
    fireEvent.change(input, { target: { value: "budget to:siva" } });
    await waitFor(() => expect(screen.getAllByTestId("search-person")[0]).toHaveTextContent("Siva Surendira"), { timeout: 3000 });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSearch).toHaveBeenCalledWith('to:"siva@lyzr.ai" budget');
    expect(screen.getByTestId("search-chip")).toHaveTextContent("To: Siva Surendira");
  });

  it("Enter with nothing highlighted searches the typed text; Escape closes the list", async () => {
    const { input, onSearch } = mount();
    fireEvent.change(input, { target: { value: "report has:attachment" } });
    await screen.findByTestId("search-suggestions");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("search-suggestions")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSearch).toHaveBeenCalledWith("hasAttachments:true report");
    expect(screen.getByTestId("search-chip")).toHaveTextContent("Has attachment");
  });

  it("empty box lists recent searches and operators; a recent pick re-runs it", async () => {
    localStorage.setItem("msui.recentSearches", JSON.stringify(["subject:invoice", "hello"]));
    const { input, onSearch } = mount();
    fireEvent.focus(input);
    const recents = await screen.findAllByTestId("search-recent");
    expect(recents).toHaveLength(2);
    expect(screen.getAllByTestId("search-operator").length).toBe(8);
    fireEvent.mouseDown(recents[0]);
    expect(onSearch).toHaveBeenCalledWith("subject:invoice");
    expect(screen.getByTestId("search-chip")).toHaveTextContent("Subject: invoice");
  });

  it("shows chips for a query arriving from the URL and Backspace removes the last one", () => {
    const { input, onSearch } = mount(vi.fn(), 'from:"x@y.z" isRead:false hello');
    expect(screen.getAllByTestId("search-chip").map((c) => c.textContent)).toEqual(["From: x@y.z", "Unread"]);
    expect(input.value).toBe("hello");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onSearch).toHaveBeenCalledWith('from:"x@y.z"');
  });
});
