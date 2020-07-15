import { all, call, fork, put, select, takeLatest, takeEvery } from "redux-saga/effects";
import { find, get, isNil, remove } from "lodash";
import {
  types,
  setEncounterFormMappings,
  getEncounterForm,
  setEncounterForm,
  setEncounter,
  saveEncounterComplete,
  setValidationResults
} from "../reducers/encounterReducer";
import api from "../api";
import {
  selectFormMappingsForSubjectType,
  selectFormMappingForEncounter
} from "./encounterSelector";
import { mapForm } from "../../common/adapters";
import {
  Encounter,
  Individual,
  ModelGeneral as General,
  ObservationsHolder,
  Concept
} from "avni-models";
import { setSubjectProfile } from "../reducers/subjectDashboardReducer";
import { getSubjectGeneral } from "../reducers/generalSubjectDashboardReducer";
import { mapProfile, mapEncounter } from "../../common/subjectModelMapper";

export default function*() {
  yield all(
    [
      encouterOnLoadWatcher,
      encounterFetchFormWatcher,
      updateEncounterObsWatcher,
      saveEncounterWatcher,
      createEncounterWatcher,
      createEncounterForScheduledWatcher
    ].map(fork)
  );
}

export function* encouterOnLoadWatcher() {
  yield takeLatest(types.ON_LOAD, encouterOnLoadWorker);
}
export function* encouterOnLoadWorker({ subjectUuid }) {
  yield put.resolve(getSubjectGeneral(subjectUuid));
  const subjectProfileJson = yield call(api.fetchSubjectProfile, subjectUuid);
  const encounterFormMappings = yield select(
    selectFormMappingsForSubjectType(subjectProfileJson.subjectType.uuid)
  );
  yield put.resolve(setEncounterFormMappings(encounterFormMappings));
  yield put.resolve(setSubjectProfile(mapProfile(subjectProfileJson)));
}

export function* encounterFetchFormWatcher() {
  yield takeLatest(types.GET_ENCOUNTER_FORM, encounterFetchFormWorker);
}
export function* encounterFetchFormWorker({ encounterTypeUuid, subjectTypeUuid }) {
  const formMapping = yield select(
    selectFormMappingForEncounter(encounterTypeUuid, subjectTypeUuid)
  );
  const encounterForm = yield call(api.fetchForm, formMapping.formUUID);
  yield put.resolve(setEncounterForm(mapForm(encounterForm)));
}

export function* createEncounterWatcher() {
  yield takeLatest(types.CREATE_ENCOUNTER, createEncounterWorker);
}
export function* createEncounterWorker({ encounterTypeUuid, subjectUuid }) {
  const subjectProfileJson = yield call(api.fetchSubjectProfile, subjectUuid);
  const state = yield select();
  const individual = new Individual();
  individual.uuid = subjectProfileJson.uuid;
  individual.registrationDate = subjectProfileJson.registrationDate;

  /*create new encounter obj */
  const encounter = new Encounter();
  encounter.uuid = General.randomUUID();
  encounter.encounterDateTime = new Date();
  encounter.observations = [];
  encounter.individual = individual;
  encounter.encounterType = find(
    state.dataEntry.metadata.operationalModules.encounterTypes,
    eT => eT.uuid === encounterTypeUuid
  );
  encounter.name = encounter.encounterType.name;

  yield put.resolve(setEncounter(encounter));
  yield put.resolve(
    getEncounterForm(encounter.encounterType.uuid, subjectProfileJson.subjectType.uuid)
  );
  yield put.resolve(setSubjectProfile(mapProfile(subjectProfileJson)));
}

export function* createEncounterForScheduledWatcher() {
  yield takeLatest(types.CREATE_ENCOUNTER_FOR_SCHEDULED, createEncounterForScheduledWorker);
}
export function* createEncounterForScheduledWorker({ encounterUuid }) {
  const encounterJson = yield call(api.fetchEncounter, encounterUuid);
  const subjectProfileJson = yield call(api.fetchSubjectProfile, encounterJson.subjectUUID);

  const individual = new Individual();
  individual.uuid = subjectProfileJson.uuid;
  individual.registrationDate = subjectProfileJson.registrationDate;

  const encounter = mapEncounter(encounterJson);
  encounter.encounterDateTime = new Date();
  encounter.individual = individual;

  yield put.resolve(setEncounter(encounter));
  yield put.resolve(
    getEncounterForm(encounter.encounterType.uuid, subjectProfileJson.subjectType.uuid)
  );
  yield put.resolve(setSubjectProfile(mapProfile(subjectProfileJson)));
}

function* updateEncounterObsWatcher() {
  yield takeEvery(types.UPDATE_OBS, updateEncounterObsWorker);
}
export function* updateEncounterObsWorker({ formElement, value }) {
  const state = yield select();
  const encounter = state.dataEntry.encounterReducer.encounter;
  const validationResults = state.dataEntry.encounterReducer.validationResults;
  encounter.observations = updateObservations(encounter.observations, formElement, value);

  yield put(setEncounter(encounter));
  yield put(
    setValidationResults(validate(formElement, value, encounter.observations, validationResults))
  );
}

function updateObservations(observations, formElement, value) {
  const observationHolder = new ObservationsHolder(observations);
  if (formElement.concept.datatype === Concept.dataType.Coded && formElement.isMultiSelect()) {
    const answer = observationHolder.toggleMultiSelectAnswer(formElement.concept, value);
  } else if (
    formElement.concept.datatype === Concept.dataType.Coded &&
    formElement.isSingleSelect()
  ) {
    observationHolder.toggleSingleSelectAnswer(formElement.concept, value);
  } else if (
    formElement.concept.datatype === Concept.dataType.Duration &&
    !isNil(formElement.durationOptions)
  ) {
    observationHolder.updateCompositeDurationValue(formElement.concept, value);
  } else if (
    formElement.concept.datatype === Concept.dataType.Date &&
    !isNil(formElement.durationOptions)
  ) {
    observationHolder.addOrUpdatePrimitiveObs(formElement.concept, value);
  } else {
    observationHolder.addOrUpdatePrimitiveObs(formElement.concept, value);
  }
  return observationHolder.observations;
}

function validate(formElement, value, observations, validationResults) {
  let isNullForMultiselect = false;
  if (formElement.concept.datatype === Concept.dataType.Coded && formElement.isMultiSelect()) {
    const observationHolder = new ObservationsHolder(observations);
    const answers =
      observationHolder.findObservation(formElement.concept) &&
      observationHolder.findObservation(formElement.concept).getValue();

    isNullForMultiselect = isNil(answers);
  }

  const validationResult = formElement.validate(isNullForMultiselect ? null : value);

  remove(
    validationResults,
    existingValidationResult =>
      existingValidationResult.formIdentifier === validationResult.formIdentifier
  );

  validationResults.push(validationResult);
  return validationResults;
}

export function* saveEncounterWatcher() {
  yield takeLatest(types.SAVE_ENCOUNTER, saveEncounterWorker);
}

export function* saveEncounterWorker() {
  const state = yield select();
  const encounter = state.dataEntry.encounterReducer.encounter;
  let resource = encounter.toResource;
  yield call(api.saveEncounter, resource);
  yield put(saveEncounterComplete());
}
