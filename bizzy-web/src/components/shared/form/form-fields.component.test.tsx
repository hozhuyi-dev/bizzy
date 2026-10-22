import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppForm } from "./form.hook";
import { moneyError, requiredError } from "~/core/utils/form.util";

function TestForm({ onSubmit }: { onSubmit: (value: { name: string; fee: string }) => void }) {
  const form = useAppForm({
    defaultValues: { name: "", fee: "" },
    onSubmit: ({ value }) => onSubmit(value),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="name" validators={{ onChange: ({ value }) => requiredError(value, "Name is required") }}>
        {(field) => <field.TextField label="Name" />}
      </form.AppField>
      <form.AppField name="fee" validators={{ onChange: ({ value }) => moneyError(value) }}>
        {(field) => <field.TextField label="Fee" inputMode="decimal" />}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton label="Save" />
      </form.AppForm>
    </form>
  );
}

describe("form fields", () => {
  test("an error waits until the field is left", async () => {
    const user = userEvent.setup();
    render(<TestForm onSubmit={vi.fn()} />);
    const fee = screen.getByLabelText("Fee");
    await user.type(fee, "9.");
    expect(screen.queryByText("An amount, like 95 or 95.50")).toBeNull();
    await user.tab();
    expect(screen.getByText("An amount, like 95 or 95.50")).toBeInTheDocument();
    expect(fee).toHaveAttribute("aria-invalid", "true");
    await user.type(fee, "5");
    expect(screen.queryByText("An amount, like 95 or 95.50")).toBeNull();
  });

  test("a submit with problems shows them all, takes the cursor to the first, and sends nothing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Fee"), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("An amount, like 95 or 95.50")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a valid form submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Name"), "Jane");
    await user.type(screen.getByLabelText("Fee"), "95");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: "Jane", fee: "95" }));
  });
});
