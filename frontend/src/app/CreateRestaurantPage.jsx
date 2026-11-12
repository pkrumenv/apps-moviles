import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Container,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

import { useSession } from "./session-context.jsx";
import { loadGoogleMaps } from "./google-maps.js";

export default function CreateRestaurantPage() {
  const { api } = useSession();
  const navigate = useNavigate();
  const [styles, setStyles] = useState([]);
  const [values, setValues] = useState({ name: "", address: "" });
  const [catalogue, setCatalogue] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api.cuisineStyles({ signal: controller.signal })
      .then((items) => !controller.signal.aborted && setCatalogue(items))
      .catch((cause) => !controller.signal.aborted && setError(cause.message));
    return () => controller.abort();
  }, [api]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const maps = await loadGoogleMaps();
      const geocoder = new maps.Geocoder();
      const { results, status } = await geocoder.geocode({ address: values.address.trim() });
      if (status !== "OK" || !results?.length) {
        throw new Error(status === "ZERO_RESULTS"
          ? "No encontramos esa dirección. Revísala e incluye comuna y ciudad."
          : "No se pudo ubicar la dirección. Revisa la clave de Google Maps e inténtalo otra vez.");
      }

      const location = results[0].geometry.location;
      const created = await api.createRestaurant({
        name: values.name.trim(),
        address: values.address.trim(),
        latitude: location.lat(),
        longitude: location.lng(),
        cuisine_styles: styles,
      });
      navigate(`/restaurants/${created.id}`, { replace: true });
    } catch (cause) {
      const existingId = cause?.payload?.detail?.restaurant?.id;
      if (cause.status === 409 && existingId) {
        setError("Ya existe un restaurante con ese nombre y dirección. Te llevamos a su ficha.");
        setTimeout(() => navigate(`/restaurants/${existingId}`), 900);
      } else {
        setError(cause.message || "No se pudo crear el restaurante.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="sm" className="page-content">
      <Stack spacing={2}>
        <Typography variant="h1">Nuevo restaurante</Typography>
        {error && <Alert severity={error.startsWith("Ya existe") ? "warning" : "error"}>{error}</Alert>}
        <Card>
          <CardContent>
            <Box component="form" onSubmit={submit} className="field-stack">
              <TextField
                label="Nombre"
                required
                value={values.name}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              />
              <TextField
                label="Dirección"
                required
                value={values.address}
                onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))}
                helperText="La ubicaremos en el mapa para que aparezca en la exploración y búsqueda por cercanía."
              />
              <Typography variant="subtitle2">Estilos de comida (elige uno o más)</Typography>
              {catalogue.map((style) => (
                <FormControlLabel
                  key={style.id}
                  control={(
                    <Checkbox
                      checked={styles.includes(style.slug)}
                      onChange={(event) => setStyles((current) => event.target.checked
                        ? [...current, style.slug]
                        : current.filter((slug) => slug !== style.slug))}
                    />
                  )}
                  label={style.name}
                />
              ))}
              <Button type="submit" variant="contained" disabled={busy || !styles.length}>
                {busy ? "Ubicando y creando…" : "Crear restaurante"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}
