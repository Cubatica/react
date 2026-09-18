import EditIcon from "@mui/icons-material/Edit";
import { Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Divider, Stack, TextField, Typography } from "@mui/material";
import { addLogs } from "@/components/Routines/api/workoutLogs";
import { WorkoutLog } from "@/components/Routines/models/WorkoutLog";
import { WorkoutSession } from "@/components/Routines/models/WorkoutSession";
import { useFetchRoutineRepUnitsQuery, useFetchRoutineWeighUnitsQuery } from "@/components/Routines/queries/units";
import { useSessionsQuery } from "@/components/Routines/queries/sessions";
import { ExerciseLog, TimeSeriesChart } from "@/components/Routines/widgets/LogWidgets";
import { QueryKey } from "@/core/lib/consts";
import { dateToLocale } from "@/core/lib/date";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

const present = (value: number | null) => value !== null && value !== undefined;
const number = (value: number | null) => value === null ? "—" : Number.isInteger(value) ? value.toString() : value.toFixed(1);
const duration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = Math.floor(seconds % 60);
    return [hours, minutes, remainder].map(value => value.toString().padStart(2, "0")).join(":");
};
export const workoutMetrics = (log: WorkoutLog, repetitionUnit = "", weightUnit = "") => {
    const measure = repetitionUnit.trim().toLowerCase();
    const load = weightUnit.trim();
    const metrics: string[] = [];
    if (present(log.repetitions)) {
        if (measure === "seconds") metrics.push(`Time ${duration(log.repetitions!)}`);
        else if (measure === "kilometers" || measure === "kilometres") metrics.push(`Distance ${number(log.repetitions)} km`);
        else if (present(log.weight) && !load.toLowerCase().includes("hour")) return [`${number(log.repetitions)} reps × ${number(log.weight)}${load ? ` ${load}` : ""}`];
        else metrics.push(`${number(log.repetitions)} reps`);
    }
    if (present(log.weight)) metrics.push(`${load.toLowerCase().includes("hour") ? "Speed" : "Load"} ${number(log.weight)}${load ? ` ${load}` : ""}`);
    return metrics;
};
const sessionName = (session: WorkoutSession) => {
    const sourceTitle = session.notes?.match(/^Original source title:\s*(.+)$/im)?.[1]?.trim();
    return sourceTitle || session.dayObj?.name || session.notes?.split(/\r?\n/, 1)[0]?.trim() || session.logs[0]?.exerciseObj?.getTranslation().name || "Workout";
};
const sessionUrl = (lang: string, id: string | null) => `/${lang}/routine/session/${id}`;

const previousLogs = (log: WorkoutLog, sessions: WorkoutSession[]) => {
    const current = sessions.find(session => session.id === log.sessionId);
    if (!current) return [];
    return sessions
        .filter(session => session.datetimeStart < current.datetimeStart && session.logs.some(entry => entry.exerciseId === log.exerciseId))
        .sort((a, b) => b.datetimeStart.getTime() - a.datetimeStart.getTime())[0]
        ?.logs.filter(entry => entry.exerciseId === log.exerciseId)
        .sort((a, b) => (a.iteration ?? 0) - (b.iteration ?? 0)) ?? [];
};

export const SetSummary = ({ log, sessions }: { log: WorkoutLog, sessions: WorkoutSession[] }) => {
    const weightUnits = useFetchRoutineWeighUnitsQuery();
    const repetitionUnits = useFetchRoutineRepUnitsQuery();
    const weightUnit = log.weightUnitObj?.name ?? weightUnits.data?.find(item => item.id === log.weightUnitId)?.name ?? "";
    const repetitionUnit = log.repetitionUnitObj?.name ?? repetitionUnits.data?.find(item => item.id === log.repetitionUnitId)?.name ?? "";
    const metrics = workoutMetrics(log, repetitionUnit, weightUnit);
    const prior = previousLogs(log, sessions);
    const index = Math.max(0, [...(sessions.find(session => session.id === log.sessionId)?.logs ?? [])]
        .filter(entry => entry.exerciseId === log.exerciseId)
        .sort((a, b) => (a.iteration ?? 0) - (b.iteration ?? 0))
        .findIndex(entry => entry.id === log.id));
    const previous = prior[index] ?? prior.at(-1);
    const loadDelta = previous?.weight != null && log.weight != null ? log.weight - previous.weight : null;
    const measureDelta = previous?.repetitions != null && log.repetitions != null ? log.repetitions - previous.repetitions : null;
    const delta = loadDelta !== null && loadDelta !== 0
        ? { value: loadDelta, unit: weightUnit }
        : measureDelta !== null && measureDelta !== 0 ? { value: measureDelta, unit: repetitionUnit || "reps" } : null;
    const up = delta !== null && delta.value > 0;
    return <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75} sx={{ alignItems: { sm: "center" } }}>
        <Typography component="span">{metrics.length ? metrics.join(" · ") : "No recorded metrics"}</Typography>
        {delta && <Chip size="small" color={up ? "success" : "error"} label={`${up ? "▲" : "▼"} ${delta.value > 0 ? "+" : ""}${number(delta.value)}${delta.unit ? ` ${delta.unit}` : ""} vs last time`} />}
    </Stack>;
};

export const WorkoutsOverview = () => {
    const { lang = "en" } = useParams();
    const sessionsQuery = useSessionsQuery();
    const [search, setSearch] = useState("");
    const [visible, setVisible] = useState(30);
    const sentinel = useRef<HTMLDivElement>(null);
    const sessions = useMemo(() => [...(sessionsQuery.data ?? [])]
        .sort((a, b) => b.datetimeStart.getTime() - a.datetimeStart.getTime())
        .filter(session => `${sessionName(session)} ${session.logs.map(log => log.exerciseObj?.getTranslation().name ?? "").join(" ")}`.toLowerCase().includes(search.toLowerCase())), [sessionsQuery.data, search]);
    useEffect(() => {
        const node = sentinel.current;
        if (!node) return;
        const observer = new IntersectionObserver(entries => entries[0].isIntersecting && setVisible(count => Math.min(count + 30, sessions.length)));
        observer.observe(node);
        return () => observer.disconnect();
    }, [sessions.length]);
    useEffect(() => setVisible(30), [search]);
    if (sessionsQuery.isLoading) return <CircularProgress />;
    if (sessionsQuery.isError) return <Typography color="error">Could not load workouts.</Typography>;
    return <Box sx={{ maxWidth: 900, mx: "auto", p: 2 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>All workouts</Typography>
        <TextField fullWidth label="Search workout or exercise" value={search} onChange={event => setSearch(event.target.value)} sx={{ mb: 2 }} />
        <Stack spacing={1.5}>
            {sessions.slice(0, visible).map(session => <Card key={session.id} variant="outlined">
                <CardActionArea component={Link} to={sessionUrl(lang, session.id)}>
                    <CardContent>
                        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
                            <Box>
                                <Typography variant="h6">{sessionName(session)}</Typography>
                                <Typography color="text.secondary">{dateToLocale(session.datetimeStart)} · {session.logs.length} entries</Typography>
                            </Box>
                            <Typography color="text.secondary">View</Typography>
                        </Stack>
                        {session.logs.slice(0, 2).map(log => <SetSummary key={log.id} log={log} sessions={sessionsQuery.data ?? []} />)}
                    </CardContent>
                </CardActionArea>
            </Card>)}
            {sessions.length === 0 && <Typography color="text.secondary">No workouts match this search.</Typography>}
            <div ref={sentinel} />
        </Stack>
    </Box>;
};

export const SessionDetail = () => {
    const { sessionId = "" } = useParams();
    const sessionsQuery = useSessionsQuery();
    const queryClient = useQueryClient();
    const session = sessionsQuery.data?.find(item => item.id === sessionId);
    const [adding, setAdding] = useState(false);
    if (sessionsQuery.isLoading) return <CircularProgress />;
    if (!session) return <Typography color="error">Workout session not found.</Typography>;
    const grouped = new Map<number, WorkoutLog[]>();
    session.logs.forEach(log => grouped.set(log.exerciseId, [...(grouped.get(log.exerciseId) ?? []), log]));
    const addSet = async (last: WorkoutLog) => {
        setAdding(true);
        try {
            await addLogs([{ date: session.datetimeStart.toISOString(), iteration: last.iteration, exercise: last.exerciseId, session: session.id, routine: session.routineId, slot_entry: last.slotEntryId, repetitions_unit: last.repetitionUnitId, repetitions: last.repetitions, weight_unit: last.weightUnitId, weight: last.weight, rir: last.rir, rest: last.restTime }]);
            await queryClient.invalidateQueries({ queryKey: [QueryKey.SESSIONS_FULL] });
        } finally { setAdding(false); }
    };
    return <Box sx={{ maxWidth: 1100, mx: "auto", p: 2 }}>
        <Typography variant="h4">{sessionName(session)}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{dateToLocale(session.datetimeStart)} · stable session {session.id}</Typography>
        <Button startIcon={<EditIcon />} href="#edit" variant="contained" sx={{ mb: 2 }}>Edit workout sets</Button>
        <Divider />
        <Box id="edit">
            {Array.from(grouped.values()).map(logs => <Box key={logs[0].exerciseId} sx={{ mb: 3 }}>
                <ExerciseLog exercise={logs[0].exerciseObj!} routineId={session.routineId} logEntries={logs} />
                <Button disabled={adding} onClick={() => addSet(logs.at(-1)!)}>+ Add set</Button>
            </Box>)}
        </Box>
    </Box>;
};

export const ExerciseProgression = ({ exerciseId }: { exerciseId: number }) => {
    const { lang = "en" } = useParams();
    const sessionsQuery = useSessionsQuery();
    const logs = useMemo(() => (sessionsQuery.data ?? []).flatMap(session => session.logs)
        .filter(log => log.exerciseId === exerciseId)
        .sort((a, b) => a.date.getTime() - b.date.getTime()), [sessionsQuery.data, exerciseId]);
    if (sessionsQuery.isLoading) return <CircularProgress />;
    return <Box sx={{ mt: 4 }}>
        <Typography variant="h5" sx={{ mb: 1 }}>Your progression</Typography>
        {logs.length === 0 ? <Typography color="text.secondary">No recorded sets for this exercise yet.</Typography> : <>
            <TimeSeriesChart data={logs} />
            <Stack divider={<Divider />}>
                {[...logs].reverse().map(log => <Box key={log.id} sx={{ py: 1 }}>
                    <Typography component={Link} to={sessionUrl(lang, log.sessionId)} sx={{ fontWeight: 600 }}>{dateToLocale(log.date)}</Typography>
                    <SetSummary log={log} sessions={sessionsQuery.data ?? []} />
                </Box>)}
            </Stack>
        </>}
    </Box>;
};
