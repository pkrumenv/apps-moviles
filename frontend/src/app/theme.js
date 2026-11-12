import { createTheme } from "@mui/material/styles";

// Consolidate the local stylesheet's green, terracotta, warm surfaces,
// Inter body type and Georgia display type into the single MUI theme.
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#456633", dark: "#365128", light: "#dce8cf", contrastText: "#ffffff" },
    secondary: { main: "#1976d2", dark: "#135eaa", light: "#e4f0fc", contrastText: "#ffffff" },
    background: { default: "#ffffff", paper: "#ffffff" },
    text: { primary: "#202020", secondary: "#626262" },
    divider: "#e2e2e2",
    error: { main: "#7c271d", light: "#f6dfda" },
    success: { main: "#174b2b", light: "#dcebdd" },
  },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500, letterSpacing: "-0.045em" },
    h2: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500, letterSpacing: "-0.025em" },
    h3: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500 },
    button: { fontWeight: 650, textTransform: "none" },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiButton: {
      styleOverrides: { root: { minHeight: 44, borderRadius: 12, paddingInline: 18 } },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid #e2e2e2",
          boxShadow: "0 3px 12px rgb(0 0 0 / 8%)",
        },
      },
    },
    MuiTextField: { defaultProps: { fullWidth: true, size: "medium" } },
  },
});
