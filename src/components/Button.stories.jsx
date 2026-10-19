import { Button } from "./Button";

export default {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    disabled: { control: "boolean" },
    loading: { control: "boolean" },
  },
};

export const Primary = {
  args: { variant: "primary", children: "Save Task" },
};

export const Secondary = {
  args: { variant: "secondary", children: "Cancel" },
};

export const Ghost = {
  args: { variant: "ghost", children: "Edit" },
};

export const Danger = {
  args: { variant: "danger", children: "Delete" },
};

export const Small = {
  args: { variant: "primary", size: "sm", children: "Add" },
};

export const Large = {
  args: { variant: "primary", size: "lg", children: "Create New Task" },
};

export const Loading = {
  args: { variant: "primary", loading: true, children: "Saving..." },
};

export const Disabled = {
  args: { variant: "primary", disabled: true, children: "Disabled" },
};

export const AllVariants = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
};

export const AllSizes = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};
