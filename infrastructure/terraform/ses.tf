# Transactional email (invites, password resets, receipts, certificates) through Amazon SES in
# Mumbai. New SES accounts start in the sandbox: request production access (docs/DEPLOYMENT.md).
resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain_name
}

resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# Bounces and complaints come back to a subdomain we control (better deliverability, SPF-aligned).
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity   = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain = "mail.${var.domain_name}"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "mail.${var.domain_name}"
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "mail.${var.domain_name}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = "_dmarc.${var.domain_name}"
  type            = "TXT"
  ttl             = 1800
  records         = ["v=DMARC1; p=quarantine; adkim=r; aspf=r"]
  allow_overwrite = true
}

# The API sends through SES's SMTP endpoint; SMTP credentials are derived from this user's key.
resource "aws_iam_user" "ses_smtp" {
  name = "${local.prefix}-ses-smtp"
}

resource "aws_iam_user_policy" "ses_smtp" {
  name = "send-email"
  user = aws_iam_user.ses_smtp.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendRawEmail", "ses:SendEmail"]
      Resource = "*"
      Condition = {
        StringLike = { "ses:FromAddress" = "*@${var.domain_name}" }
      }
    }]
  })
}

resource "aws_iam_access_key" "ses_smtp" {
  user = aws_iam_user.ses_smtp.name
}
