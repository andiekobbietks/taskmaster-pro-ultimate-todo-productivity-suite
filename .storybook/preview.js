import { themes } from "@storybook/theming";

export const parameters = {
  actions: { argTypesRegex: "^on[A-Z].*" },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
  backgrounds: {
    default: "light",
    values: [
      { name: "light", value: "#F8FAFC" },
      { name: "dark", value: "#0A0E1A" },
    ],
  },
};

export const decorators = [
  (Story) => (
    <div className="font-sans">
      <Story />
    </div>
  ),
];
