import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Navy taken from the Presentify logo (#0B2E5C at index 7).
const navy: MantineColorsTuple = [
  '#eaf1fb', '#d3e0f3', '#a6c0e6', '#759ed9', '#4d82cd', '#3470c6', '#1f5aa8', '#0b2e5c', '#0a2850', '#071d3b',
];

export const theme = createTheme({
  primaryColor: 'navy',
  primaryShade: 7,
  colors: { navy },
  fontFamily: "'Noto Sans', 'Noto Sans Kannada', system-ui, -apple-system, 'Segoe UI', sans-serif",
  headings: {
    fontFamily: "'Noto Sans', 'Noto Sans Kannada', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontWeight: '700',
  },
  defaultRadius: 'md',
  fontSizes: { xs: '0.8125rem', sm: '0.9375rem', md: '1rem', lg: '1.125rem', xl: '1.3rem' },
  focusRing: 'always',
  cursorType: 'pointer',
  components: {
    Button: { defaultProps: { size: 'md' } },
    TextInput: { defaultProps: { size: 'md' } },
    PasswordInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md', autosize: true, minRows: 3 } },
  },
});
