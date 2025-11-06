function getStatus(receipt) {
    if (receipt.withdrawn) return "Returned";
    if (Date.now() / 1000 >= receipt.lockUntil) return "Pending Return";
    return "Locked";
}

// Remove/disable Withdraw button for principal
