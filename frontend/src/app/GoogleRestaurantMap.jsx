import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Stack } from "@mui/material";
import { loadGoogleMaps } from "./google-maps.js";

const DEFAULT_CENTER = { lat: -33.4489, lng: -70.6693 };

function containsBounds(outer, inner) {
  const sw = outer.getSouthWest(); const ne = outer.getNorthEast();
  const isw = inner.getSouthWest(); const ine = inner.getNorthEast();
  return sw.lat() <= isw.lat() && ne.lat() >= ine.lat() && sw.lng() <= isw.lng() && ne.lng() >= ine.lng();
}

export default function GoogleRestaurantMap({ api, restaurants = [], onOpenRestaurant, center, onBoundsResults }) {
  const elementRef = useRef(null); const mapRef = useRef(null); const markersRef = useRef(new Map());
  const infoRef = useRef(null); const fetchedBoundsRef = useRef(null); const requestIdRef = useRef(0);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) { setError("Configura VITE_GOOGLE_MAPS_API_KEY en frontend/.env.local y reinicia Vite para mostrar el mapa."); return undefined; }
    let alive = true; let idleListener; let timer;
    loadGoogleMaps(key).then((maps) => {
      if (!alive || !elementRef.current) return;
      const map = new maps.Map(elementRef.current, { center: center || DEFAULT_CENTER, zoom: center ? 13 : 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false });
      mapRef.current = map; infoRef.current = new maps.InfoWindow();
      idleListener = map.addListener("idle", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const bounds = map.getBounds(); if (!bounds) return;
          if (fetchedBoundsRef.current && containsBounds(fetchedBoundsRef.current, bounds)) return;
          const sw = bounds.getSouthWest(); const ne = bounds.getNorthEast(); const req = ++requestIdRef.current;
          setLoading(true); setError("");
          try {
            const result = await api.mapRestaurants({ south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() });
            if (!alive || req !== requestIdRef.current) return;
            fetchedBoundsRef.current = bounds; setTruncated(Boolean(result.truncated)); onBoundsResults?.(result.items || []);
          } catch (cause) { if (alive && req === requestIdRef.current) setError(cause.message || "No se pudieron cargar los restaurantes de esta zona."); }
          finally { if (alive && req === requestIdRef.current) setLoading(false); }
        }, 450);
      });
    }).catch((cause) => { if (alive) setError(cause.message); });
    return () => { alive = false; clearTimeout(timer); idleListener?.remove(); markersRef.current.forEach((marker) => marker.setMap(null)); markersRef.current.clear(); mapRef.current = null; };
  }, [api, retry]);

  useEffect(() => { if (center && mapRef.current) { mapRef.current.panTo(center); mapRef.current.setZoom(13); } }, [center]);

  useEffect(() => {
    const map = mapRef.current; const maps = window.google?.maps;
    if (!map || !maps) return;
    const items = restaurants; const ids = new Set(items.map((item) => String(item.id)));
    markersRef.current.forEach((marker, id) => { if (!ids.has(id)) { marker.setMap(null); markersRef.current.delete(id); } });
    items.forEach((restaurant) => {
      if (restaurant.latitude == null || restaurant.longitude == null) return;
      const id = String(restaurant.id); let marker = markersRef.current.get(id);
      if (!marker) {
        marker = new maps.Marker({ map, position: { lat: Number(restaurant.latitude), lng: Number(restaurant.longitude) }, title: restaurant.name });
        marker.addListener("click", () => { infoRef.current.setContent(`<strong>${String(restaurant.name).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])}</strong><br><button type="button" id="restaurant-map-open">Ver ficha</button>`); infoRef.current.open({ map, anchor: marker }); maps.event.addListenerOnce(infoRef.current, "domready", () => document.getElementById("restaurant-map-open")?.addEventListener("click", () => onOpenRestaurant?.(restaurant.id))); });
        markersRef.current.set(id, marker);
      } else { marker.setPosition({ lat: Number(restaurant.latitude), lng: Number(restaurant.longitude) }); marker.setMap(map); }
    });
  }, [restaurants, onOpenRestaurant]);

  return <Stack spacing={1}>
    {error && <Alert severity="warning" action={import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? <Button color="inherit" size="small" onClick={() => { setError(""); setRetry((n) => n + 1); }}>Reintentar</Button> : undefined}>{error}</Alert>}
    {loading && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><span>Actualizando restaurantes de la zona…</span></Stack>}
    {truncated && <Alert severity="info">Hay demasiados restaurantes en esta zona. Acerca el mapa para verlos todos.</Alert>}
    <Box ref={elementRef} role="application" aria-label="Mapa interactivo de restaurantes" sx={{ width: "100%", height: { xs: 360, sm: 480 }, borderRadius: 2, overflow: "hidden", backgroundColor: "#e8eee5" }} />
  </Stack>;
}
