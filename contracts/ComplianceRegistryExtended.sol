// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// contracts/ComplianceRegistryExtended.sol
//
// Extensão do ComplianceRegistry.sol existente para suportar
// attestations relayadas do Midnight Network.
//
// Adicionar estas definições ao contrato existente, OU herdar dele.

contract ComplianceRegistryExtended {

    // ─── Structs ───────────────────────────────────────────────────────────

    struct Attestation {
        bytes32 orgHash;        // Hash do CNPJ/org identifier
        string  regulation;     // "LGPD" | "GDPR" | "MiCA"
        uint256 score;          // 0-100
        uint256 validUntil;     // unix timestamp
        bytes32 agentDid;       // DID do agente auditor
        string  evidenceCid;    // IPFS CID do documento de evidência
        bytes32 commitment;     // ZK commitment do Midnight (prova sem revelar)
        string  source;         // "midnight" | "direct"
        uint256 timestamp;      // block.timestamp do relay
        bool    exists;
    }

    // ─── Storage ───────────────────────────────────────────────────────────

    mapping(bytes32 => Attestation) public attestations;
    uint256 public attestationCount;

    address public admin;
    address public trustedRelayer;  // Endereço do dpo2u-relayer

    // ─── Events ────────────────────────────────────────────────────────────

    event AttestationRelayed(
        bytes32 indexed attestationId,
        bytes32 indexed orgHash,
        string  regulation,
        uint256 score,
        string  source
    );

    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    // ─── Errors ────────────────────────────────────────────────────────────

    error NotAuthorizedRelayer();
    error AttestationAlreadyExists(bytes32 attestationId);
    error InvalidScore(uint256 score);
    error InvalidAttestation();

    // ─── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != trustedRelayer) revert NotAuthorizedRelayer();
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(address _admin, address _trustedRelayer) {
        admin = _admin;
        trustedRelayer = _trustedRelayer;
    }

    // ─── Relayer Functions ─────────────────────────────────────────────────

    /// @notice Registra uma attestation relayada do Midnight Network
    /// @dev Chamada exclusivamente pelo trustedRelayer (dpo2u-relayer)
    /// @param attestationId  ID único gerado no Midnight
    /// @param orgHash        Hash do identificador da organização
    /// @param regulation     Framework regulatório ("LGPD", "GDPR", etc.)
    /// @param score          Score de compliance (0-100)
    /// @param validUntil     Timestamp de validade
    /// @param agentDid       DID do agente que realizou a auditoria
    /// @param evidenceCid    CID do documento de evidência no IPFS
    /// @param commitment     ZK commitment do estado privado no Midnight
    function registerAttestationFromMidnight(
        bytes32 attestationId,
        bytes32 orgHash,
        string calldata regulation,
        uint256 score,
        uint256 validUntil,
        bytes32 agentDid,
        string calldata evidenceCid,
        bytes32 commitment
    ) external onlyRelayer returns (bool) {
        // Validações
        if (attestations[attestationId].exists) {
            revert AttestationAlreadyExists(attestationId);
        }
        if (score > 100) revert InvalidScore(score);
        if (orgHash == bytes32(0)) revert InvalidAttestation();

        // Armazena a attestation
        attestations[attestationId] = Attestation({
            orgHash:     orgHash,
            regulation:  regulation,
            score:       score,
            validUntil:  validUntil,
            agentDid:    agentDid,
            evidenceCid: evidenceCid,
            commitment:  commitment,
            source:      "midnight",
            timestamp:   block.timestamp,
            exists:      true
        });

        attestationCount++;

        emit AttestationRelayed(
            attestationId,
            orgHash,
            regulation,
            score,
            "midnight"
        );

        return true;
    }

    // ─── View Functions ────────────────────────────────────────────────────

    /// @notice Verifica se uma attestation existe (para idempotência do relayer)
    function attestationExists(bytes32 attestationId) external view returns (bool) {
        return attestations[attestationId].exists;
    }

    /// @notice Verifica se uma org está em compliance com um dado framework
    /// @param orgHash     Hash do CNPJ/org
    /// @param regulation  "LGPD" | "GDPR" etc.
    /// @param minScore    Score mínimo aceitável
    function verifyCompliance(
        bytes32 orgHash,
        string calldata regulation,
        uint256 minScore
    ) external view returns (bool isCompliant, uint256 score, uint256 validUntil) {
        // Percorre attestations para encontrar a válida mais recente
        // Em produção: usar mapping(orgHash => attestationId[]) para eficiência
        // Por ora: o caller precisa passar o attestationId diretamente
        // TODO: indexar por orgHash
        return (false, 0, 0);
    }

    /// @notice Consulta direta por attestationId
    function getAttestation(bytes32 attestationId)
        external
        view
        returns (Attestation memory)
    {
        return attestations[attestationId];
    }

    // ─── Admin Functions ───────────────────────────────────────────────────

    function setTrustedRelayer(address newRelayer) external onlyAdmin {
        emit RelayerUpdated(trustedRelayer, newRelayer);
        trustedRelayer = newRelayer;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
    }
}
