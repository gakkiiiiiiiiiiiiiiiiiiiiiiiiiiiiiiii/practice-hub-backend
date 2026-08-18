function requiresTrialPass(job) {
  return !(job?.alwaysFullAccess === true || Number(job?.alwaysFullAccess) === 1);
}

function shouldRunFullPass(trialOnly, trialResult) {
  if (trialOnly) return false;
  if (Number(trialResult?.attempted || 0) === 0) return true;

  return (
    Number(trialResult?.processed || 0) === 0 &&
    Array.isArray(trialResult?.failures) &&
    trialResult.failures.length > 0
  );
}

module.exports = {
  requiresTrialPass,
  shouldRunFullPass,
};
